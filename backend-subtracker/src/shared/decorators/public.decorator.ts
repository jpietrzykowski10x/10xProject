import { Reflector } from '@nestjs/core';

export const PUBLIC_METADATA_KEY = 'auth:public';

// Every route requires a session unless it carries @Public().
export const Public = Reflector.createDecorator<void, true>({
  key: PUBLIC_METADATA_KEY,
  transform: () => true,
});
