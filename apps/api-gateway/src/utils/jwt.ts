// Injectable JWT signing and verification at the HTTP boundary.

import jwt, {
  type JwtPayload,
  type SignOptions,
  type VerifyOptions,
} from 'jsonwebtoken';

const JWT_ALGORITHM = 'HS256';

export interface JwtServiceConfig {
  secret: string;
  expiresIn: SignOptions['expiresIn'];
  issuer?: string;
  audience?: string;
}

export interface JwtUser {
  id: string;
  email: string;
}

export interface AccessTokenClaims {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
}

/** The interface Gateway controllers and middleware can receive via injection. */
export interface JwtTokenService {
  sign(user: JwtUser): string;
  verify(token: string): AccessTokenClaims;
}

export class JwtService implements JwtTokenService {
  constructor(private readonly config: JwtServiceConfig) {
    if (config.secret.length < 32) {
      throw new Error('JWT secret must be at least 32 characters long');
    }
  }

  sign(user: JwtUser): string {
    return jwt.sign(
      { email: user.email },
      this.config.secret,
      this.signOptions(user.id),
    );
  }

  verify(token: string): AccessTokenClaims {
    const decoded = jwt.verify(token, this.config.secret, this.verifyOptions());

    if (!isAccessTokenClaims(decoded)) {
      throw new Error('JWT does not contain the required access-token claims');
    }

    return decoded;
  }

  private signOptions(subject: string): SignOptions {
    return {
      algorithm: JWT_ALGORITHM,
      subject,
      expiresIn: this.config.expiresIn,
      ...(this.config.issuer !== undefined
        ? { issuer: this.config.issuer }
        : {}),
      ...(this.config.audience !== undefined
        ? { audience: this.config.audience }
        : {}),
    };
  }

  private verifyOptions(): VerifyOptions {
    return {
      algorithms: [JWT_ALGORITHM],
      ...(this.config.issuer !== undefined
        ? { issuer: this.config.issuer }
        : {}),
      ...(this.config.audience !== undefined
        ? { audience: this.config.audience }
        : {}),
    };
  }
}

function isAccessTokenClaims(value: string | JwtPayload): value is AccessTokenClaims {
  return (
    typeof value !== 'string' &&
    typeof value.sub === 'string' &&
    typeof value.email === 'string'
  );
}
