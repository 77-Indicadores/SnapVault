import { nanoid } from "nanoid";

export const id = (prefix: string) => `${prefix}_${nanoid(12)}`;
export const now = () => new Date().toISOString();
