import { Global, Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Global()
@Module({ controllers: [AuthController, AccountController], providers: [AuthService], exports: [AuthService] })
export class AuthModule {}
