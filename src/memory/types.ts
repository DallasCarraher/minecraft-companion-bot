import { z } from 'zod';

export const ChatTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  username: z.string().optional(),
  text: z.string(),
  at: z.string(),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

export const TaskQueueItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'active', 'done', 'interrupted', 'failed']),
  createdAt: z.string(),
});
export type TaskQueueItem = z.infer<typeof TaskQueueItemSchema>;

export const KnownLocationSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  label: z.string(),
  note: z.string().optional(),
});
export type KnownLocation = z.infer<typeof KnownLocationSchema>;

export const PlayerPermissionSchema = z.object({
  role: z.enum(['owner', 'trusted', 'guest']),
  allowed: z.boolean(),
});
export type PlayerPermission = z.infer<typeof PlayerPermissionSchema>;

export const BotStateSchema = z.object({
  version: z.literal(1),
  realmId: z.string(),
  conversation: z.array(ChatTurnSchema),
  goal: z.object({ description: z.string(), createdAt: z.string() }).nullable(),
  taskQueue: z.array(TaskQueueItemSchema),
  knownLocations: z.record(z.string(), KnownLocationSchema),
  playerPermissions: z.record(z.string(), PlayerPermissionSchema),
  inventorySnapshot: z
    .object({
      items: z.array(z.object({ name: z.string(), count: z.number() })),
      capturedAt: z.string(),
    })
    .nullable(),
});
export type BotState = z.infer<typeof BotStateSchema>;

export function createDefaultState(realmId: string): BotState {
  return {
    version: 1,
    realmId,
    conversation: [],
    goal: null,
    taskQueue: [],
    knownLocations: {},
    playerPermissions: {},
    inventorySnapshot: null,
  };
}
