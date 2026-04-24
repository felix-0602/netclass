// better-sqlite3 包成 D1-like 异步链式接口。
// 目的：routes/*.ts 的业务代码一行不改，就能从 Cloudflare Workers D1
// 迁到自托管 Node + SQLite。
//
// 只支持 routes 实际用到的子集：prepare → bind → first/all/run/first<T>() 以及 batch()。
//
// 参考 Cloudflare 的 D1Database 类型：
//   https://developers.cloudflare.com/d1/platform/client-api/

import type BetterSqlite3 from 'better-sqlite3';

export interface D1LikeResult {
  meta: { changes: number; duration?: number; last_row_id?: number | null };
  results?: unknown[];
  success: boolean;
}

export interface D1LikePreparedStatement {
  bind(...args: unknown[]): D1LikePreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[]; meta: { changes: number } }>;
  run<T = unknown>(): Promise<D1LikeResult & { results?: T[] }>;
  raw<T = unknown>(): Promise<T[]>;
}

export interface D1LikeDatabase {
  prepare(sql: string): D1LikePreparedStatement;
  batch(stmts: D1LikePreparedStatement[]): Promise<D1LikeResult[]>;
  exec(sql: string): Promise<D1LikeResult>;
}

/**
 * 把一个 better-sqlite3 的 Database 实例包成 D1-like 接口。
 */
export function createSqliteAdapter(db: BetterSqlite3.Database): D1LikeDatabase {
  return {
    prepare(sql: string): D1LikePreparedStatement {
      const stmt = db.prepare(sql);
      return makePrepared(stmt, []);
    },

    async batch(stmts: D1LikePreparedStatement[]): Promise<D1LikeResult[]> {
      // better-sqlite3 的 transaction 是同步的；把整批包进事务保证原子
      const tx = db.transaction(() => {
        return stmts.map((s) => (s as InternalPrepared).__runSync());
      });
      return tx();
    },

    async exec(sql: string): Promise<D1LikeResult> {
      db.exec(sql);
      return { meta: { changes: 0 }, success: true };
    },
  };
}

/** 仅内部可见：同步版 run，供 batch 事务内部调用 */
interface InternalPrepared extends D1LikePreparedStatement {
  __runSync(): D1LikeResult;
}

function makePrepared(
  stmt: BetterSqlite3.Statement,
  boundArgs: unknown[],
): InternalPrepared {
  const runSync = (): D1LikeResult => {
    const info = (stmt as BetterSqlite3.Statement).run(...boundArgs);
    return {
      meta: {
        changes: info.changes,
        last_row_id:
          typeof info.lastInsertRowid === 'bigint'
            ? Number(info.lastInsertRowid)
            : info.lastInsertRowid,
      },
      success: true,
    };
  };

  return {
    bind(...args: unknown[]): D1LikePreparedStatement {
      return makePrepared(stmt, [...boundArgs, ...args]);
    },

    async first<T = unknown>(): Promise<T | null> {
      // better-sqlite3 对 SELECT 用 .get()；对非 SELECT 用 .run()
      // 业务代码里 first() 只用于 SELECT，故直接 get
      const row = stmt.get(...boundArgs) as T | undefined;
      return row ?? null;
    },

    async all<T = unknown>(): Promise<{ results: T[]; meta: { changes: number } }> {
      const rows = stmt.all(...boundArgs) as T[];
      return { results: rows, meta: { changes: 0 } };
    },

    async run<T = unknown>(): Promise<D1LikeResult & { results?: T[] }> {
      return runSync() as D1LikeResult & { results?: T[] };
    },

    async raw<T = unknown>(): Promise<T[]> {
      // better-sqlite3 的 raw() 返回二维数组
      const rawStmt = stmt.raw(true);
      const rows = rawStmt.all(...boundArgs) as T[];
      return rows;
    },

    __runSync: runSync,
  };
}
