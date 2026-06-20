import { handlers } from "@/auth";

// Auth.js route handlers (powers session endpoints and any future OAuth flows).
export const { GET, POST } = handlers;

export const runtime = "nodejs";
