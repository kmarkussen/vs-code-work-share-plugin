/**
 * Shared TypeScript types for Work Share API.
 * Used by plugin, server, and dashboard to ensure consistent contracts.
 */

import "reflect-metadata";
import { IsString, IsIn, IsArray, ValidateNested, IsNumber, IsBoolean, IsOptional } from "class-validator";
import { Type } from "class-transformer";

/**
 * User input: activity event from plugin.
 */
export class ActivityDto {
    @IsString()
    filePath!: string;

    @IsString()
    userName!: string;

    @IsString()
    timestamp!: string;

    @IsIn(["open", "edit", "close"])
    action!: "open" | "edit" | "close";

    @IsString()
    repositoryRemoteUrl!: string;
}

/**
 * Batch of activities sent by plugin to server.
 */
export class ActivityBatchDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ActivityDto)
    activities!: ActivityDto[];
}

/**
 * User input: code patch from plugin.
 */
export class PatchDto {
    @IsString()
    repositoryRemoteUrl!: string;

    @IsString()
    userName!: string;

    @IsString()
    repositoryFilePath!: string;

    @IsString()
    baseCommit!: string;

    @IsString()
    patch!: string;

    @IsString()
    timestamp!: string;
}

/**
 * Server response: metadata about a code patch.
 */
export class StoredPatch extends PatchDto {
    @IsString()
    id!: string;

    @IsString()
    receivedAt!: string;
}

/**
 * Server internal: file being edited with active users and patches.
 */
export class FileInfo {
    @IsString()
    repositoryRemoteUrl!: string;

    @IsString()
    repositoryFilePath!: string;

    @IsString()
    repositoryFileName!: string;

    @IsArray()
    @IsString({ each: true })
    activeUsers!: string[];

    @IsNumber()
    patchCount!: number;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => StoredPatch)
    patches!: StoredPatch[];

    @IsString()
    lastActivity!: string;
}

/**
 * Server internal: repository with files organized by active editors.
 */
export class RepositoryFilesInfo {
    @IsString()
    repositoryRemoteUrl!: string;

    @IsString()
    repositoryName!: string;

    @IsNumber()
    fileCount!: number;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => FileInfo)
    files!: FileInfo[];
}

/**
 * Server response: GET /activities endpoint.
 */
export class GetActivitiesResponse {
    @IsNumber()
    count!: number;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ActivityDto)
    activities!: ActivityDto[];
}

/**
 * Server response: GET /patches endpoint.
 */
export class GetPatchesResponse {
    @IsNumber()
    count!: number;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => StoredPatch)
    patches!: StoredPatch[];
}

/**
 * Server response: GET /files endpoint.
 */
export class GetFilesResponse {
    @IsNumber()
    count!: number;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => RepositoryFilesInfo)
    repositories!: RepositoryFilesInfo[];
}

/**
 * Server response: POST /activities endpoint.
 */
export class PostActivitiesResponse {
    @IsBoolean()
    success!: boolean;

    @IsString()
    message!: string;

    @IsString()
    timestamp!: string;
}

/**
 * Server response: POST /patches endpoint.
 */
export class PostPatchesResponse {
    @IsBoolean()
    success!: boolean;

    @IsString()
    message!: string;

    @IsString()
    timestamp!: string;
}

/**
 * Health check response.
 */
export class HealthCheckResponse {
    @IsString()
    status!: string;

    @IsString()
    timestamp!: string;
}

/**
 * Generic error response.
 */
export class ErrorResponse {
    @IsNumber()
    statusCode!: number;

    @IsString()
    message!: string;
}
