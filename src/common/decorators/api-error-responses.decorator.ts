import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';

// Reusable error responses so every route documents the shared error envelope.
// Each helper attaches the ErrorResponseDto schema so Swagger UI shows a real
// example payload instead of a bare description.

export const ApiBadRequest = (description = 'Invalid request') =>
  applyDecorators(ApiResponse({ status: 400, description, type: ErrorResponseDto }));

// Documents the global ValidationPipe, which answers with an array of field messages.
export const ApiValidationFailed = () =>
  applyDecorators(
    ApiResponse({
      status: 400,
      description:
        'The request failed validation. `message` is an array of per-field messages.',
      type: ErrorResponseDto,
    }),
  );

export const ApiUnauthorized = (description = 'Unauthorized') =>
  applyDecorators(ApiResponse({ status: 401, description, type: ErrorResponseDto }));

// The same guard answer on every bearer-protected route, so it is defined once.
export const ApiTokenRequired = () =>
  applyDecorators(
    ApiResponse({
      status: 401,
      description: 'The access token is missing, expired, or revoked',
      type: ErrorResponseDto,
    }),
  );

export const ApiForbidden = (description = 'Forbidden') =>
  applyDecorators(ApiResponse({ status: 403, description, type: ErrorResponseDto }));

export const ApiNotFound = (description = 'Not found') =>
  applyDecorators(ApiResponse({ status: 404, description, type: ErrorResponseDto }));

export const ApiConflict = (description = 'Conflict') =>
  applyDecorators(ApiResponse({ status: 409, description, type: ErrorResponseDto }));

// Used where a caller is being slowed down rather than refused: too many failed
// sign-ins, or too many wrong verification codes.
export const ApiTooManyRequests = (
  description = 'Too many attempts. The caller is being slowed down, not refused.',
) =>
  applyDecorators(ApiResponse({ status: 429, description, type: ErrorResponseDto }));

export const ApiServiceUnavailable = (
  description = 'Redis is unavailable, so the OTP could not be processed',
) =>
  applyDecorators(ApiResponse({ status: 503, description, type: ErrorResponseDto }));