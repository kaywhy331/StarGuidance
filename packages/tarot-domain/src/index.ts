import { z } from "zod";

export const cardOrientationSchema = z.enum(["upright", "reversed"]);

export type CardOrientation = z.infer<typeof cardOrientationSchema>;

export const SHUFFLE_VERSION = "fisher-yates-csprng-v1" as const;
