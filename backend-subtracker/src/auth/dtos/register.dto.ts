import { Equals, IsEmail, MaxLength } from 'class-validator';
import { EMAIL_MAX_LENGTH } from '../../users/entities/user.entity.js';
import { NormalizedEmail } from './request-link.dto.js';

export class RegisterDto {
  @NormalizedEmail()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email: string;

  @Equals(true)
  confirmedAdult: boolean;

  @Equals(true)
  acceptedPrivacyPolicy: boolean;
}
