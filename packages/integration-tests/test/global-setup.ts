import { execFileSync } from 'node:child_process'
import type { TestProject } from 'vitest/node'
import pg from 'pg'

/**
 * Provides a logical-replication-enabled Postgres for integration tests.
 * Honors WALCAST_TEST_DSN if set (e.g. in CI with a service container);
 * otherwise starts a throwaway docker container. If neither is possible the
 * integration suite skips itself.
 */

const CONTAINER = 'walcast-itest-pg'
const PORT = 54331
const DSN = `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`

const KAFKA_CONTAINER = 'walcast-itest-kafka'
const KAFKA_PORT = 19093
const BROKER = `127.0.0.1:${KAFKA_PORT}`

declare module 'vitest' {
  interface ProvidedContext {
    dsn: string
    brokers: string[]
  }
}

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

async function waitForPostgres(dsn: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const client = new pg.Client({ connectionString: dsn })
    try {
      await client.connect()
      await client.query('SELECT 1')
      return
    } catch (err) {
      if (Date.now() > deadline) throw err
      await new Promise((r) => setTimeout(r, 300))
    } finally {
      await client.end().catch(() => {})
    }
  }
}

async function waitForKafka(broker: string, timeoutMs = 90_000): Promise<void> {
  const { Kafka, logLevel } = await import('kafkajs')
  const admin = new Kafka({
    clientId: 'ready',
    brokers: [broker],
    logLevel: logLevel.NOTHING,
  }).admin()
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await admin.connect()
      await admin.listTopics()
      await admin.disconnect()
      return
    } catch (err) {
      await admin.disconnect().catch(() => {})
      if (Date.now() > deadline) throw err
      await new Promise((r) => setTimeout(r, 750))
    }
  }
}

let startedContainer = false
let startedKafka = false

async function setupKafka(project: TestProject): Promise<void> {
  if (process.env.WALCAST_TEST_KAFKA) {
    project.provide('brokers', process.env.WALCAST_TEST_KAFKA.split(','))
    return
  }
  try {
    const running = docker('ps', '-q', '--filter', `name=^${KAFKA_CONTAINER}$`).trim()
    if (!running) {
      docker('rm', '-f', KAFKA_CONTAINER)
      docker(
        'run',
        '-d',
        '--name',
        KAFKA_CONTAINER,
        '-p',
        `${KAFKA_PORT}:9092`,
        '-e',
        'KAFKA_NODE_ID=1',
        '-e',
        'KAFKA_PROCESS_ROLES=broker,controller',
        // INTERNAL is what the broker's transaction coordinator dials —
        // pointing it at the host-mapped port breaks EOS.
        '-e',
        'KAFKA_LISTENERS=EXTERNAL://0.0.0.0:9092,INTERNAL://localhost:29092,CONTROLLER://localhost:9093',
        '-e',
        `KAFKA_ADVERTISED_LISTENERS=EXTERNAL://${BROKER},INTERNAL://localhost:29092`,
        '-e',
        'KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=EXTERNAL:PLAINTEXT,INTERNAL:PLAINTEXT,CONTROLLER:PLAINTEXT',
        '-e',
        'KAFKA_INTER_BROKER_LISTENER_NAME=INTERNAL',
        '-e',
        'KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER',
        '-e',
        'KAFKA_CONTROLLER_QUORUM_VOTERS=1@localhost:9093',
        '-e',
        'KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1',
        '-e',
        'KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1',
        '-e',
        'KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1',
        '-e',
        'KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0',
        'apache/kafka:3.9.0',
      )
      startedKafka = true
    }
    await waitForKafka(BROKER)
    project.provide('brokers', [BROKER])
  } catch {
    console.warn('[integration tests] kafka unavailable — kafka money test will be skipped')
    project.provide('brokers', [])
  }
}

export async function setup(project: TestProject): Promise<void> {
  await setupKafka(project)
  if (process.env.WALCAST_TEST_DSN) {
    project.provide('dsn', process.env.WALCAST_TEST_DSN)
    return
  }
  try {
    const running = docker('ps', '-q', '--filter', `name=^${CONTAINER}$`).trim()
    if (!running) {
      docker('rm', '-f', CONTAINER).toString() // clear any stopped leftover
      docker(
        'run',
        '-d',
        '--name',
        CONTAINER,
        '-e',
        'POSTGRES_PASSWORD=postgres',
        '-p',
        `${PORT}:5432`,
        'postgres:16-alpine',
        '-c',
        'wal_level=logical',
      )
      startedContainer = true
    }
    await waitForPostgres(DSN)
    project.provide('dsn', DSN)
  } catch {
    console.warn('[walcast tests] docker unavailable — integration tests will be skipped')
    project.provide('dsn', '')
  }
}

export function teardown(): void {
  if (startedContainer && !process.env.WALCAST_TEST_KEEP_PG) {
    try {
      docker('rm', '-f', CONTAINER)
    } catch {
      /* already gone */
    }
  }
  if (startedKafka && !process.env.WALCAST_TEST_KEEP_KAFKA) {
    try {
      docker('rm', '-f', KAFKA_CONTAINER)
    } catch {
      /* already gone */
    }
  }
}
