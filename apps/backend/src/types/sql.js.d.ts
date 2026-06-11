declare module 'sql.js' {
  type SqlValue = string | number | Uint8Array | null

  interface PreparedStatement {
    bind(params: (string | number | Uint8Array | null)[]): boolean
    step(): boolean
    get(): (string | number | Uint8Array | null)[]
    getColumnNames(): string[]
    free(): boolean
  }

  export interface Database {
    run(sql: string, params?: SqlValue[]): void
    exec(sql: string): { columns: string[]; values: SqlValue[][] }[]
    prepare(sql: string): PreparedStatement
    export(): Uint8Array
    close(): void
  }

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database
  }

  export default function initSqlJs(): Promise<SqlJsStatic>
}
