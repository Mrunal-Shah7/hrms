import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  namespace: '/notifications',
  cors: { origin: process.env.WEBSOCKET_CORS_ORIGIN || 'http://localhost:3000' },
})
export class NotificationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(client: { handshake: { auth?: { token?: string }; headers?: { authorization?: string } }; join: (room: string) => void; disconnect: () => void }) {
    const token =
      client.handshake?.auth?.token ??
      client.handshake?.headers?.authorization?.replace('Bearer ', '');
    if (!token) {
      this.logger.warn('WebSocket connection rejected: no token');
      client.disconnect();
      return;
    }
    try {
      const secret = this.config.getOrThrow<string>('TENANT_JWT_ACCESS_SECRET');
      const payload = this.jwtService.verify(token, { secret }) as {
        userId?: string;
        type?: string;
      };
      if (payload.type !== 'tenant' || !payload.userId) {
        this.logger.warn('WebSocket connection rejected: invalid token type');
        client.disconnect();
        return;
      }
      client.join(`user:${payload.userId}`);
    } catch {
      this.logger.warn('WebSocket connection rejected: invalid token');
      client.disconnect();
    }
  }

  handleDisconnect() {
    // Client disconnected
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }
}
