import { randomUUID } from 'node:crypto'
import type { MqttClient } from 'mqtt'
import type { Command, CommandRequest } from './contract.js'

export interface CommandRelay {
  // Stamps the Operator's command with its cmd_id and ts and publishes it to its Sentinel.
  // Gives back the command as published, or says why the broker did not take it.
  relay(request: CommandRequest): Promise<{ success: true; data: Command } | { success: false; reason: string }>
}

// Publishes at QoS 1: settles once the broker acknowledged. If the connection drops first, the
// message is taken back, which rejects, instead of going out again whenever the broker returns.
function publishNow(client: MqttClient, topic: string, payload: string): Promise<unknown> {
  let messageId: number | undefined
  const takeBack = () => {
    if (messageId !== undefined) client.removeOutgoingMessage(messageId)
  }
  client.once('close', takeBack)
  return client
    .publishAsync(topic, payload, {
      qos: 1,
      // Runs as the message enters the outgoing store, right after it was given its id.
      cbStorePut: () => {
        messageId = client.getLastMessageId()
      },
    })
    .finally(() => client.off('close', takeBack))
}

export function createCommandRelay(client: MqttClient): CommandRelay {
  return {
    async relay(request) {
      // A command is for now: the broker takes it on the spot, or it is refused and never sent.
      if (!client.connected) return { success: false, reason: 'the broker is away' }

      const command: Command = { cmd_id: randomUUID(), ...request, ts: new Date().toISOString() }
      try {
        await publishNow(client, `command/${command.sentinel}/actuator`, JSON.stringify(command))
      } catch {
        return { success: false, reason: 'the broker went away before taking it' }
      }
      return { success: true, data: command }
    },
  }
}
