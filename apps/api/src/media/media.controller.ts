import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Public } from '../common/decorators';
import { MediaService, POSTER_NAME } from './media.service';

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };

/** Serves stored event posters. Names are random and validated, so no path can escape the folder. */
@Public()
@SkipThrottle()
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get('posters/:name')
  async poster(@Param('name') name: string, @Res() res: Response) {
    if (!POSTER_NAME.test(name)) throw new NotFoundException();
    const file = join(this.media.dir, name);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException();
    res.setHeader('Content-Type', TYPES[name.split('.').pop()!]);
    res.setHeader('Content-Length', String(info.size));
    // Names never change content, so caching forever is safe.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Shown on the web app's origin; nothing in a poster may run as a page.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    createReadStream(file).pipe(res);
  }
}
