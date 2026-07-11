/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { splitStatements } from './sqlSplit'

describe('splitStatements — basic', () => {
  it('splits plain statements on ;', () => {
    expect(splitStatements('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2'])
  })
  it('ignores ; inside strings and comments', () => {
    expect(splitStatements("INSERT INTO t VALUES (';'); SELECT 1")).toEqual([
      "INSERT INTO t VALUES (';')",
      'SELECT 1',
    ])
    expect(splitStatements('SELECT 1 -- a; b\n; SELECT 2')).toEqual([
      'SELECT 1 -- a; b',
      'SELECT 2',
    ])
  })
  it('trailing content without ; is still emitted', () => {
    expect(splitStatements('SELECT 1')).toEqual(['SELECT 1'])
  })
})

describe('splitStatements — PL/SQL blocks (Oracle/DM)', () => {
  it('keeps a trigger body as one statement (does not cut at internal ;)', () => {
    const trg = `CREATE OR REPLACE TRIGGER "T"."NEW_TRIGGER"\n  BEFORE INSERT ON "T"."TT"\n  FOR EACH ROW\nBEGIN\n  NULL;\nEND;`
    const stmts = splitStatements(trg)
    expect(stmts).toHaveLength(1)
    expect(stmts[0]).toContain('END;')
  })
  it('keeps procedure/function bodies whole', () => {
    const proc = 'CREATE OR REPLACE PROCEDURE p IS\nBEGIN\n  INSERT INTO t VALUES (1);\n  NULL;\nEND;'
    expect(splitStatements(proc)).toHaveLength(1)
  })
  it("splits PL/SQL objects on SQL*Plus '/' terminators", () => {
    const pkg = 'CREATE OR REPLACE PACKAGE pk AS\n  PROCEDURE hello;\nEND;\n/\n\nCREATE OR REPLACE PACKAGE BODY pk AS\n  PROCEDURE hello IS\n  BEGIN\n    NULL;\n  END;\nEND;\n/'
    const stmts = splitStatements(pkg)
    expect(stmts).toHaveLength(2)
    expect(stmts[0]).toMatch(/^CREATE OR REPLACE PACKAGE pk/)
    expect(stmts[1]).toMatch(/^CREATE OR REPLACE PACKAGE BODY pk/)
    expect(stmts.every((s) => !s.includes('/'))).toBe(true) // 终止符 / 已吞掉
  })
  it('anonymous DECLARE/BEGIN block is one statement', () => {
    expect(splitStatements('DECLARE x INT;\nBEGIN\n  x := 1;\nEND;')).toHaveLength(1)
  })
  it('a CREATE TABLE then a trigger: table splits, trigger stays whole', () => {
    const sql = 'CREATE TABLE t (id INT);\nCREATE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW BEGIN NULL; END;'
    const stmts = splitStatements(sql)
    expect(stmts).toHaveLength(2)
    expect(stmts[1]).toContain('END;')
  })
})

describe('splitStatements — transaction BEGIN vs PL/SQL BEGIN', () => {
  it('treats BEGIN; / BEGIN WORK as transaction control (still splits)', () => {
    expect(splitStatements('BEGIN; INSERT INTO t VALUES (1); COMMIT;')).toEqual([
      'BEGIN',
      'INSERT INTO t VALUES (1)',
      'COMMIT',
    ])
  })
})

describe('splitStatements — PG dollar-quoting', () => {
  it('protects ; inside $$ … $$ function bodies', () => {
    const fn = `CREATE FUNCTION f() RETURNS trigger AS $$\nBEGIN\n  RAISE NOTICE 'a;b';\n  RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;\nSELECT 1`
    const stmts = splitStatements(fn)
    expect(stmts).toHaveLength(2)
    expect(stmts[0]).toContain('LANGUAGE plpgsql')
    expect(stmts[1]).toBe('SELECT 1')
  })
  it('protects ; inside named $tag$ … $tag$', () => {
    expect(splitStatements('SELECT $body$a;b$body$; SELECT 2')).toEqual([
      'SELECT $body$a;b$body$',
      'SELECT 2',
    ])
  })
})
