import { environment } from '../../../environments/environment';

/** Where the Quarkus backend runs; swapped per build via fileReplacements. */
export const API_BASE = environment.apiBase;

export const api = (path: string): string => API_BASE + path;
