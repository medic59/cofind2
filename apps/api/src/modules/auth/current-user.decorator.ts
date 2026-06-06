import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { UserRole, UserStatus } from "@prisma/client";

export type RequestUser = {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
};

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): RequestUser | undefined => {
  const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
  return request.user;
});

