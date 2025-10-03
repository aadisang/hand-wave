import type { Context as HonoContext } from "hono";

export type CreateContextOptions = {
	context: HonoContext;
};

/**
 * Create a request context object for handlers.
 *
 * Currently returns an object with `session: null` (no authentication configured).
 *
 * @returns An object with a `session` property (currently always `null`).
 */
export async function createContext({
	context: _context,
}: CreateContextOptions) {
	// No auth configured
	return {
		session: null,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
