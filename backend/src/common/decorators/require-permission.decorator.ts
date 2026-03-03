import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'required_permission';

export interface RequiredPermission {
  module: string;
  action: string;
  resource: string;
}

export function RequirePermission(module: string, action: string, resource: string) {
  return SetMetadata(PERMISSION_KEY, { module, action, resource } satisfies RequiredPermission);
}
