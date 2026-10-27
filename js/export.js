// 내려받기 도우미: 엑셀에서 바로 열리는 CSV, 전체 백업 JSON
import { sb, friendlyError } from './api.js';

function cell(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) v = v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)).join(' / ');
  else if (typeof v === 'object') v = JSON.stringify(v);
  const s = String(v);
  // 엑셀이 =, +, -, @ 로 시작하는 칸을 수식으로 읽지 않게 앞에 ' 를 붙여요.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

// columns: [[key, 머리글]] 또는 없으면 모든 칸
export function toCsv(rows, columns) {
  const cols = columns || [...new Set(rows.flatMap((r) => Object.keys(r)))].map((k) => [k, k]);
  const lines = [cols.map(([, h]) => cell(h)).join(',')];
  for (const r of rows) lines.push(cols.map(([k]) => cell(typeof k === 'function' ? k(r) : r[k])).join(','));
  // 맨 앞 BOM 이 있어야 엑셀에서 한글이 깨지지 않아요.
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function download(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// 표 하나를 1000줄씩 끝까지 읽어요.
export async function fetchAll(table, columns = '*') {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(friendlyError(error));
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}
