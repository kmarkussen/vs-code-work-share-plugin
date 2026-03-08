import { IsString, IsIn, IsISO8601, Matches } from "class-validator";

/**
 * Activity payload received from VS Code plugin clients.
 */
export class ActivityDto {
    /** Absolute file path in the contributor's local workspace. */
    @IsString()
    filePath!: string;

    /** Display name that identifies who performed the action. */
    @IsString()
    @Matches(/\S/, { message: "userName must contain non-whitespace characters" })
    userName!: string;

    /** Client-side event timestamp in ISO 8601 format. */
    @IsISO8601()
    timestamp!: string;

    /** File lifecycle action captured by the plugin. */
    @IsIn(["open", "edit", "close"])
    action!: "open" | "edit" | "close";

    /**
     * Remote URL used as the repository identity for cross-user filtering.
     */
    @IsString()
    repositoryRemoteUrl!: string;
}
