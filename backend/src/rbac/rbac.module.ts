import { Module } from '@nestjs/common';
import { RbacService } from './rbac.service';
import { RolesController } from './rbac.controller';
import { PermissionsController } from './permissions.controller';
import { UserRolesController } from './user-roles.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RolesController, PermissionsController, UserRolesController],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
