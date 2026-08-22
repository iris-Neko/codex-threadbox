import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

const source = resolve('resources', 'icon.svg')
const output = resolve('resources', 'icon.png')

await mkdir(resolve('resources'), { recursive: true })
await sharp(source).resize(1024, 1024).png({ compressionLevel: 9 }).toFile(output)
