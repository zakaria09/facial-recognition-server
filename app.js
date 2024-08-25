import express from 'express'
import multer from 'multer'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import dotenv from 'dotenv'
import crypto from 'crypto'
import sharp from 'sharp'
import { PrismaClient } from '@prisma/client'
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import {
  RekognitionClient,
  DetectFacesCommand,
  CreateCollectionCommand,
  SearchFacesByImageCommand,
  IndexFacesCommand,
  DeleteCollectionCommand
} from "@aws-sdk/client-rekognition";
import { equal } from 'assert';

dotenv.config()

const prisma = new PrismaClient()

const randomImageName = (bytes = 32) =>
  crypto.randomBytes(bytes).toString("hex")

const bucketName = process.env.BUCKET_NAME
const bucketRegion = process.env.BUCKET_REGION
const accessKey = process.env.ACCESS_KEY
const secretAccessKey = process.env.SECRET_ACCESS_KEY

const s3 = new S3Client({
  credentials: {
    accessKeyId: accessKey,
    secretAccessKey: secretAccessKey
  },
  region: bucketRegion
})

  const rekogClient = new RekognitionClient({
    region: bucketRegion,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretAccessKey,
    },
  });

const app = express()

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const createUrl = (imageName) => {
      const getObjectParams = {
      Bucket: bucketName,
      Key: imageName
    }
    const command = new GetObjectCommand(getObjectParams);
    return getSignedUrl(s3, command, { expiresIn: 3600 });
}

app.delete('/api/faces', async (req, res) => {
  await prisma.faces.deleteMany()
  await prisma.image.deleteMany()
  res.send({})
})

app.delete("/api/collection", async (req, res) => {
  await rekogClient.send(
    new DeleteCollectionCommand({ CollectionId: "face-database" })
  );
  res.send({});
});

app.get('/api/face/:id', async (req, res) => {
  const id = req.params.id;
  console.log(id)
  const face = await prisma.faces.findFirst({
    where: { externalId: { equals: id } },
  }); 
  const image = await prisma.image.findUnique({
    where: { id: face.faceId }
  })
  const url = await createUrl(image.image)
  res.send({...image, url})
})

app.get('/api/faces', async (req, res) => {
  const faces = await prisma.image.findMany()
  console.log('faces', faces)

  for (const face of faces) {
    face.url = await createUrl(face.image)
  }

  res.send(faces)
})


app.post("/api/searchFace", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400);

  const resizedImg = await sharp(req.file.buffer)
    .resize({ height: 1920, width: 1080, fit: "contain" })
    .toBuffer();

  const imageName = randomImageName();

  const params = {
    Bucket: bucketName,
    Key: imageName,
    Body: resizedImg,
    ContentType: req.file.mimetype,
  };
  const command = new PutObjectCommand(params);

  await s3.send(command);

  const input = {
    // SearchFacesByImageRequest
    CollectionId: "face-database", // required
    Image: {
      S3Object: {
        // S3Object
        Bucket: bucketName,
        Name: imageName,
      },
    },
  };

  const result = await rekogClient.send(new SearchFacesByImageCommand(input));

  const searchImage = await createUrl(imageName)

  const faceMatches = []
  if (result.FaceMatches.length) {
    for (const face of result.FaceMatches) {
      faceMatches.push(await prisma.faces.findMany({
        where: { externalId: { equals: face.Face.FaceId } },
      }));
    }
  }

  res.send({ result, searchImage, faceMatches });
});

app.post('/api/faces', upload.single('image'), async (req, res) => {

  if (!req.file) return res.status(400)

  const resizedImg = await sharp(req.file.buffer).resize({height: 1920, width: 1080, fit: 'contain'}).toBuffer()

  const imageName = randomImageName()

  const params = {
    Bucket: bucketName,
    Key: imageName,
    Body: resizedImg,
    ContentType: req.file.mimetype,
  };
  const command = new PutObjectCommand(params)

  const status = await s3.send(command)

  const param = {
    Image: {
      S3Object: {
        Bucket: bucketName,
        Name: imageName
      },
    },
  }

  const input = {
    CollectionId: "face-database",
    Image: {
      Bytes: resizedImg,
    },
  };

  let result
  try {
    result = await rekogClient.send(new IndexFacesCommand(input));
  } catch (err) {
    result = await rekogClient.send(
      new CreateCollectionCommand({ CollectionId: "face-database" })
    );
  }

  console.log("result", result);

  const image = await prisma.image.create({
    data: {
      image: imageName,
      faces: {
        create: result.FaceRecords.map(face => {
          return {
            externalId: face.Face.FaceId,
            boundingBox: face.Face.BoundingBox
          };
        })
      }
    },
  });

  console.log(status)

  res.send({
    image: image,
    faces: result.FaceRecords.map((face) => {
      return {
        externalId: face.Face.FaceId,
        boundingBox: face.Face.BoundingBox,
      };
    }),
  });
})


app.listen(8000, () => console.log('listening on port 8000'))