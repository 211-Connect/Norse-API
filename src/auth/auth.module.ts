import { Module } from '@nestjs/common';
import { KeycloakAuthService } from './services/keycloak-auth.service';
import { KeycloakGuard } from './guards/keycloak.guard';
import { CmsConfigModule } from 'src/cms-config/cms-config.module';

@Module({
  imports: [CmsConfigModule],
  providers: [KeycloakAuthService, KeycloakGuard],
  exports: [KeycloakAuthService, KeycloakGuard],
})
export class AuthModule {}
