import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";

type ErrorResponseBody = {
  message?: string | string[];
  error?: string;
  statusCode?: number;
  [key: string]: unknown;
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<{ status: (code: number) => { json: (body: unknown) => void } }>();
    const request = ctx.getRequest<{ url: string; method: string }>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = this.normalizeBody(exception, status);

    response.status(status).json({
      ok: false,
      statusCode: status,
      error: body.error || HttpStatus[status] || "Error",
      message: body.message || "Internal server error",
      path: request.url,
      method: request.method,
      timestamp: new Date().toISOString()
    });
  }

  private normalizeBody(exception: unknown, status: number): ErrorResponseBody {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === "string") {
        return { message: response, statusCode: status };
      }
      return response as ErrorResponseBody;
    }

    if (exception instanceof Error) {
      return {
        message: status >= 500 ? "Internal server error" : exception.message,
        error: exception.name,
        statusCode: status
      };
    }

    return { message: "Internal server error", statusCode: status };
  }
}
