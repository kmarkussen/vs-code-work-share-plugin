"use strict";
/**
 * Shared TypeScript types for Work Share API.
 * Used by plugin, server, and dashboard to ensure consistent contracts.
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorResponse = exports.HealthCheckResponse = exports.PostPatchesResponse = exports.PostActivitiesResponse = exports.GetFilesResponse = exports.GetPatchesResponse = exports.GetActivitiesResponse = exports.RepositoryFilesInfo = exports.FileInfo = exports.StoredPatch = exports.PatchDto = exports.ActivityBatchDto = exports.ActivityDto = void 0;
require("reflect-metadata");
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
/**
 * User input: activity event from plugin.
 */
class ActivityDto {
}
exports.ActivityDto = ActivityDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ActivityDto.prototype, "filePath", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ActivityDto.prototype, "userName", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ActivityDto.prototype, "timestamp", void 0);
__decorate([
    (0, class_validator_1.IsIn)(["open", "edit", "close"]),
    __metadata("design:type", String)
], ActivityDto.prototype, "action", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ActivityDto.prototype, "repositoryRemoteUrl", void 0);
/**
 * Batch of activities sent by plugin to server.
 */
class ActivityBatchDto {
}
exports.ActivityBatchDto = ActivityBatchDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => ActivityDto),
    __metadata("design:type", Array)
], ActivityBatchDto.prototype, "activities", void 0);
/**
 * User input: code patch from plugin.
 */
class PatchDto {
}
exports.PatchDto = PatchDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PatchDto.prototype, "repositoryRemoteUrl", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PatchDto.prototype, "userName", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PatchDto.prototype, "repositoryFilePath", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PatchDto.prototype, "baseCommit", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PatchDto.prototype, "patch", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PatchDto.prototype, "timestamp", void 0);
/**
 * Server response: metadata about a code patch.
 */
class StoredPatch extends PatchDto {
}
exports.StoredPatch = StoredPatch;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], StoredPatch.prototype, "id", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], StoredPatch.prototype, "receivedAt", void 0);
/**
 * Server internal: file being edited with active users and patches.
 */
class FileInfo {
}
exports.FileInfo = FileInfo;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FileInfo.prototype, "repositoryRemoteUrl", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FileInfo.prototype, "repositoryFilePath", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FileInfo.prototype, "repositoryFileName", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], FileInfo.prototype, "activeUsers", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], FileInfo.prototype, "patchCount", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => StoredPatch),
    __metadata("design:type", Array)
], FileInfo.prototype, "patches", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FileInfo.prototype, "lastActivity", void 0);
/**
 * Server internal: repository with files organized by active editors.
 */
class RepositoryFilesInfo {
}
exports.RepositoryFilesInfo = RepositoryFilesInfo;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], RepositoryFilesInfo.prototype, "repositoryRemoteUrl", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], RepositoryFilesInfo.prototype, "repositoryName", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], RepositoryFilesInfo.prototype, "fileCount", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => FileInfo),
    __metadata("design:type", Array)
], RepositoryFilesInfo.prototype, "files", void 0);
/**
 * Server response: GET /activities endpoint.
 */
class GetActivitiesResponse {
}
exports.GetActivitiesResponse = GetActivitiesResponse;
__decorate([
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], GetActivitiesResponse.prototype, "count", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => ActivityDto),
    __metadata("design:type", Array)
], GetActivitiesResponse.prototype, "activities", void 0);
/**
 * Server response: GET /patches endpoint.
 */
class GetPatchesResponse {
}
exports.GetPatchesResponse = GetPatchesResponse;
__decorate([
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], GetPatchesResponse.prototype, "count", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => StoredPatch),
    __metadata("design:type", Array)
], GetPatchesResponse.prototype, "patches", void 0);
/**
 * Server response: GET /files endpoint.
 */
class GetFilesResponse {
}
exports.GetFilesResponse = GetFilesResponse;
__decorate([
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], GetFilesResponse.prototype, "count", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => RepositoryFilesInfo),
    __metadata("design:type", Array)
], GetFilesResponse.prototype, "repositories", void 0);
/**
 * Server response: POST /activities endpoint.
 */
class PostActivitiesResponse {
}
exports.PostActivitiesResponse = PostActivitiesResponse;
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], PostActivitiesResponse.prototype, "success", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PostActivitiesResponse.prototype, "message", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PostActivitiesResponse.prototype, "timestamp", void 0);
/**
 * Server response: POST /patches endpoint.
 */
class PostPatchesResponse {
}
exports.PostPatchesResponse = PostPatchesResponse;
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], PostPatchesResponse.prototype, "success", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PostPatchesResponse.prototype, "message", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PostPatchesResponse.prototype, "timestamp", void 0);
/**
 * Health check response.
 */
class HealthCheckResponse {
}
exports.HealthCheckResponse = HealthCheckResponse;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], HealthCheckResponse.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], HealthCheckResponse.prototype, "timestamp", void 0);
/**
 * Generic error response.
 */
class ErrorResponse {
}
exports.ErrorResponse = ErrorResponse;
__decorate([
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], ErrorResponse.prototype, "statusCode", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ErrorResponse.prototype, "message", void 0);
//# sourceMappingURL=index.js.map