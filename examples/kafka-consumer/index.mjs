// Consume walcast change events from Kafka. @walcast/sink-kafka produces
// one topic per table (`${topicPrefix}.${schema}.${table}`), one JSON-encoded
// event per message.
import { Kafka } from 'kafkajs'

const kafka = new Kafka({
  clientId: 'walcast-example-consumer',
  brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  logLevel: 1, // errors only
})

// readUncommitted: false = read_committed isolation. The sink writes each
// batch in a Kafka transaction (its checkpoint record included), so events
// from an aborted transaction — a sink that crashed mid-batch — are never
// visible here. That is the consumer half of exactly-once: no dedupe needed.
const consumer = kafka.consumer({
  groupId: 'walcast-example',
  readUncommitted: false,
})

process.on('SIGINT', () => void consumer.disconnect())

await consumer.connect()
await consumer.subscribe({ topic: 'walcast.public.orders', fromBeginning: true })
console.log('consuming walcast.public.orders (Ctrl+C to stop)')

await consumer.run({
  eachMessage: async ({ message }) => {
    const event = JSON.parse(message.value.toString())
    console.log(
      `${event.op.padEnd(8)} ${event.schema}.${event.table} ${event.id}`,
      event.after ?? event.before,
    )
  },
})
