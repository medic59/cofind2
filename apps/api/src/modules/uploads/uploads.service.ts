import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { randomUUID } from "node:crypto";
import { UploadImageDto } from "./dto";
import { deleteUploadedImageByUrl, uploadedImagePath, uploadImageRoot } from "./upload-storage";

const contentTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp"
};

@Injectable()
export class UploadsService {
  private readonly uploadRoot = uploadImageRoot;

  async saveImage(dto: UploadImageDto) {
    const match = dto.dataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/i);
    if (!match) throw new BadRequestException("Image data URL is invalid");
    const extension = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length || buffer.length > 256 * 1024) {
      throw new BadRequestException("Image must be between 1B and 256KB");
    }
    const fileName = `${dto.purpose}-${Date.now()}-${randomUUID()}.${extension}`;
    await mkdir(this.uploadRoot, { recursive: true });
    const path = uploadedImagePath(fileName);
    if (!path) throw new BadRequestException("Image file name is invalid");
    await writeFile(path, buffer, { flag: "wx" });
    return {
      fileName,
      size: buffer.length,
      url: `${this.publicApiBase()}/uploads/images/${fileName}`
    };
  }

  async imageStream(fileName: string) {
    if (!/^[a-z0-9-]+\.(png|jpg|webp)$/i.test(fileName)) {
      throw new NotFoundException("Image not found");
    }
    const path = uploadedImagePath(fileName);
    if (!path) throw new NotFoundException("Image not found");
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException("Image not found");
    const extension = extname(fileName).toLowerCase();
    return {
      contentType: contentTypes[extension] || "application/octet-stream",
      stream: createReadStream(path)
    };
  }

  deleteByUrl(url?: string | null) {
    return deleteUploadedImageByUrl(url);
  }

  private publicApiBase() {
    return (process.env.PUBLIC_API_URL || process.env.PUBLIC_API_BASE || `http://localhost:${process.env.API_PORT || 4000}/api/v1`).replace(
      /\/+$/,
      ""
    );
  }
}
