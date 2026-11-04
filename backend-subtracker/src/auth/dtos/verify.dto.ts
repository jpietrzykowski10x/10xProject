import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Real tokens have 43 characters; this only stops arbitrarily long input on a public route.
const TOKEN_MAX_LENGTH = 64;

export class VerifyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TOKEN_MAX_LENGTH)
  token: string;
}
