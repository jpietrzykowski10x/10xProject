import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { RoleCode } from '../../shared/types/role-code.js';

// Code compares `code`, never the display name. Only active roles count towards permissions.
@Entity('role')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 30, unique: true })
  code: RoleCode;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}
