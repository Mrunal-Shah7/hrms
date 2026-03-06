import { BadRequestException } from '@nestjs/common';
import { CustomApiAdapter } from './custom-api.adapter';
import type { TimeTrackerAdapter } from './adapter.interface';
import { EsslAdapter } from './essl.adapter';
import { HubstaffAdapter } from './hubstaff.adapter';
import { MockAdapter } from './mock.adapter';

export const AdapterFactory = {
  create(provider: string, config: Record<string, unknown> = {}): TimeTrackerAdapter {
    const normalized = provider?.toLowerCase?.();
    switch (normalized) {
      case 'mock':
        return new MockAdapter(config as import('./mock.adapter').MockAdapterConfig);
      case 'essl':
        return new EsslAdapter(config as import('./essl.adapter').EsslAdapterConfig);
      case 'hubstaff':
        return new HubstaffAdapter(config as import('./hubstaff.adapter').HubstaffAdapterConfig);
      case 'custom_api':
        return new CustomApiAdapter(config as import('./custom-api.adapter').CustomApiAdapterConfig);
      default:
        throw new BadRequestException(`Unknown time tracker provider: ${provider}`);
    }
  },
};
