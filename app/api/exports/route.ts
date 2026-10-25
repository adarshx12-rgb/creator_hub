import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { renderSpecSchema } from '@/lib/render-spec';
import { cancelRender, createRender, getRender, MAX_RENDER_UPLOAD, publicRender, renderDirectory, uploadRender } from '@/lib/mp4-render';

export const runtime = 'nodejs';
export const maxDuration = 3600;
const cookie = 'studio-export-session';
const schema = z.object({ spec: renderSpecSchema, fonts: z.array(z.object({ preset: z.string().max(50), data: z.string().max(14 * 1024 * 1024).regex(/^[A-Za-z0-9+/]*={0,2}$/) })).max(14) });
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
function denied(request: NextRequest) {
  return request.headers.get('sec-fetch-site') === 'cross-site' || (!!request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin);
}
async function jobFor(request: NextRequest) {
  return getRender(request.nextUrl.searchParams.get('id') ?? '', request.cookies.get(cookie)?.value ?? '');
}
export async function POST(request: NextRequest) {
  if (denied(request)) return reply({ message: 'Cross-site requests are not allowed.' }, 403);
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply({ message: 'An export specification is required.' }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > 32 * 1024 * 1024) { await reader.cancel(); return reply({ message: 'Font files and caption settings must total less than 32 MB.' }, 413); }
      chunks.push(chunk.value);
    }
    const input = schema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const owner = request.cookies.get(cookie)?.value ?? randomUUID();
    const job = await createRender(owner, input.spec, input.fonts);
    const response = reply(publicRender(job), 201);
    response.cookies.set(cookie, owner, { httpOnly: true, sameSite: 'strict', secure: request.nextUrl.protocol === 'https:', path: '/', maxAge: 24 * 3600 });
    return response;
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return reply({ message: 'Invalid captions, font files, or export settings.' }, 400);
    return reply({ message: error instanceof Error ? error.message : 'Could not create export.' }, 429);
  }
}
export async function PUT(request: NextRequest) {
  if (denied(request)) return reply({ message: 'Cross-site requests are not allowed.' }, 403);
  const job = await jobFor(request);
  if (!job) return reply({ message: 'Export not found or expired.' }, 404);
  if (Number(request.headers.get('content-length')) > MAX_RENDER_UPLOAD) return reply({ message: 'Video exceeds the 2 GB upload limit.' }, 413);
  try { await uploadRender(job, request.body, request.signal); return reply(publicRender(job), 202); }
  catch (error) { return reply({ message: error instanceof Error ? error.message : 'Upload failed.' }, 400); }
}
export async function GET(request: NextRequest) {
  const job = await jobFor(request);
  if (!job) return reply({ message: 'Export not found or expired. Return to Studio to export again.' }, 404);
  if (request.nextUrl.searchParams.get('file') !== '1') return reply(publicRender(job));
  if (job.status !== 'complete') return reply({ message: 'The MP4 is not ready.' }, 409);
  const path = join(renderDirectory(job.id), 'output.mp4');
  const info = await stat(path).catch(() => null);
  if (!info) return reply({ message: 'This export file has expired. Export again.' }, 410);
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers: {
    'Content-Type': 'video/mp4', 'Content-Length': String(info.size), 'Content-Disposition': `attachment; filename="${job.fileName}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}
export async function DELETE(request: NextRequest) {
  if (denied(request)) return reply({ message: 'Cross-site requests are not allowed.' }, 403);
  const job = await jobFor(request);
  if (!job) return reply({ message: 'Export not found.' }, 404);
  await cancelRender(job); return reply(publicRender(job));
}
