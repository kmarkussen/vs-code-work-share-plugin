import { IsISO8601, IsString } from "class-validator";

/**
 * Shared git patch payload used for early conflict detection between users.
 */
export class PatchDto {
    /** Remote URL used as repository identity across collaborators. */
    @IsString()
    repositoryRemoteUrl!: string;

    /** Contributor display name. */
    @IsString()
    userName!: string;

    /** File path relative to repository root (stable across machines). */
    @IsString()
    repositoryFilePath!: string;

    /** Commit SHA used as patch generation base. */
    @IsString()
    baseCommit!: string;

    /** Unified diff patch text. */
    @IsString()
    patch!: string;

    /** Client timestamp in ISO 8601 format. */
    @IsISO8601()
    timestamp!: string;
}
