import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines class names using `clsx` semantics and resolves Tailwind conflicts with `twMerge`.
 *
 * Accepts values supported by `clsx` (strings, arrays, objects, etc.), normalizes them into a
 * space-delimited class string, then merges conflicting Tailwind CSS classes and returns the result.
 *
 * @param inputs - Values compatible with `clsx` to include in the final class string.
 * @returns The merged class string with Tailwind class conflicts resolved.
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
