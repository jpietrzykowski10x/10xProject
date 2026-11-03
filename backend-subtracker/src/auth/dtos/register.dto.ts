import { Equals, IsEmail, MaxLength } from 'class-validator';
import { EMAIL_MAX_LENGTH, TrimEmail } from './request-link.dto.js';

export class RegisterDto {
  @TrimEmail()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email: string;

  @Equals(true)
  confirmedAdult: boolean;

  @Equals(true)
  acceptedPrivacyPolicy: boolean;
}
