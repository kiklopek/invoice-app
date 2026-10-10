import type { Locale } from "../locales";
import { cs, type Dictionary } from "./cs";
import { en } from "./en";

export type { Dictionary };

export const dictionaries: Record<Locale, Dictionary> = { cs, en };
