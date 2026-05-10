declare module 'sql.js' {
  type SqlValue = string | number | Uint8Array | null

  export interface Database {
    run(sql: string, params?: SqlValue[]): void
    exec(sql: string): { columns: string[]; values: SqlValue[][] }[]
    export(): Uint8Array
    close(): void
  }

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database
  }

  export default function initSqlJs(): Promise<SqlJsStatic>
}
