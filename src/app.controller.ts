import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Response } from 'express';

@Controller()
export class AppController {
  @Get()
  @ApiExcludeEndpoint()
  getHome(@Res() res: Response) {
    return res.redirect('/api/docs');
  }

  @Get('favicon.ico')
  @ApiExcludeEndpoint()
  getFavicon(@Res() res: Response) {
    return res.status(204).end();
  }
}
