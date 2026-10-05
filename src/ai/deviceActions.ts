import { z } from "zod";
import type { DeviceGateway } from "../devices/types.js";

const powerSchema = z.enum(["on", "off"]);

export const setAcSchema = z
  .object({
    power: powerSchema.optional(),
    temperature: z.number().int().min(16).max(30).optional(),
    mode: z.enum(["cool", "heat", "fan", "auto", "dry"]).optional(),
    fanSpeed: z.number().int().min(1).max(5).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one AC field is required",
  );

export const setFanSchema = z
  .object({
    power: powerSchema.optional(),
    speed: z.number().int().min(1).max(5).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one fan field is required",
  );

export const setLightsSchema = z
  .object({
    power: powerSchema.optional(),
    brightness: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one lights field is required",
  );

export const setRgbSchema = z
  .object({
    power: powerSchema.optional(),
    brightness: z.number().int().min(0).max(100).optional(),
    color: z
      .object({
        r: z.number().int().min(0).max(255),
        g: z.number().int().min(0).max(255),
        b: z.number().int().min(0).max(255),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one RGB field is required",
  );

/** Validate + execute a device-control tool through DeviceGateway (no LLM). */
export async function executeDeviceAction(
  name: string,
  args: Record<string, unknown>,
  gateway: DeviceGateway,
): Promise<unknown> {
  switch (name) {
    case "set_ac": {
      const command = setAcSchema.parse(args);
      return gateway.set("bedroom.ac", command);
    }
    case "set_fan": {
      const command = setFanSchema.parse(args);
      return gateway.set("bedroom.fan", command);
    }
    case "set_lights": {
      const command = setLightsSchema.parse(args);
      return gateway.set("bedroom.lights", command);
    }
    case "set_rgb": {
      const command = setRgbSchema.parse(args);
      return gateway.set("bedroom.rgb", command);
    }
    default:
      throw new Error(`Not a device action tool: ${name}`);
  }
}

export function validateDeviceAction(
  name: string,
  args: Record<string, unknown>,
): void {
  switch (name) {
    case "set_ac":
      setAcSchema.parse(args);
      return;
    case "set_fan":
      setFanSchema.parse(args);
      return;
    case "set_lights":
      setLightsSchema.parse(args);
      return;
    case "set_rgb":
      setRgbSchema.parse(args);
      return;
    default:
      throw new Error(`Unsupported task action tool: ${name}`);
  }
}
