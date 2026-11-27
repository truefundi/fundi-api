// Shared paging defaults so every list query DTO and its service agree on
// the same limits (GET /users, GET /admin/technicians, and discovery).
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
export const MAX_SEARCH_LENGTH = 200;
