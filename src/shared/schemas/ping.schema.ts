import { z } from 'zod'

/** Example IPC channel used to verify the IPC pipeline works end-to-end. */
export const PingInputSchema = z.object({
  message: z.string().min(1).max(200)
})
export type PingInput = z.infer<typeof PingInputSchema>

export const PingOutputSchema = z.object({
  echo: z.string(),
  timestamp: z.string()
})
export type PingOutput = z.infer<typeof PingOutputSchema>
