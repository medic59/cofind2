import { PageQueryDto } from "./page-query.dto";

export function pagination(query: PageQueryDto = {}, defaultPageSize = 20, maxPageSize = 100) {
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.min(maxPageSize, Math.max(1, Number(query.pageSize || defaultPageSize)));
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize
  };
}

export function paged<T>(hits: T[], total: number, page: { page: number; pageSize: number }) {
  return {
    hits,
    pagination: {
      page: page.page,
      pageSize: page.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / page.pageSize))
    }
  };
}
