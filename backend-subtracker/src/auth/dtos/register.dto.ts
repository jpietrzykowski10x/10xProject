import { Equals } from 'class-validator';
import { ValidEmail } from './request-link.dto.js';

export class RegisterDto {
  @ValidEmail()
  email: string;

  @Equals(true)
  confirmedAdult: boolean;

  @Equals(true)
  acceptedPrivacyPolicy: boolean;
}
