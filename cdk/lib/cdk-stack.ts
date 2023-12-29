import * as cdk from 'aws-cdk-lib'
import { RemovalPolicy } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { Bucket, ObjectOwnership } from 'aws-cdk-lib/aws-s3'
import {
  CfnOriginAccessControl,
  Distribution,
  PriceClass,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront'
import { CfnDistribution } from 'aws-cdk-lib/aws-lightsail'
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam'
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment'
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins'

const namePrefix = 'sample-cloudfront-s3'

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // CloudFrontのオリジンとなるS3バケットを作成
    const originBucket = this.createOriginBucket()

    // CloudFrontのログを保存するS3バケットを作成
    const loggingBucket = this.createLoggingBucket()

    // CloudFrontディストリビューションを作成
    const distribution = this.createCloudFrontDistribution(originBucket, loggingBucket)

    // CloudFrontからのアクセスを許可するバケットポリシーを追加
    this.addToResourcePolicy(originBucket, distribution)

    // S3バケットに静的ファイルをデプロイ
    this.deployTo(originBucket)

    new cdk.CfnOutput(this, 'cloudfront-domain-name', {
      value: `https://${distribution.distributionDomainName}`,
    })
  }

  private createOriginBucket(): Bucket {
    const bucketName = `${namePrefix}-front-origin-bucket`
    return new Bucket(this, bucketName, {
      bucketName,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
    })
  }

  private createLoggingBucket(): Bucket {
    const bucketName = `${namePrefix}-front-log-bucket`
    return new Bucket(this, bucketName, {
      bucketName,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_PREFERRED,
    })
  }

  private createCloudFrontDistribution(originBucket: Bucket, loggingBucket: Bucket): Distribution {
    const cloudFrontName = `${namePrefix}-front-distribution`
    const distribution = new Distribution(this, cloudFrontName, {
      comment: cloudFrontName,
      defaultRootObject: 'index.html',
      priceClass: PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        origin: new S3Origin(originBucket, {
          originId: `${namePrefix}-front-origin`,
        }),
        viewerProtocolPolicy: ViewerProtocolPolicy.ALLOW_ALL,
      },
      logBucket: loggingBucket,
      enableLogging: true,
      logIncludesCookies: true,
    })

    // オリジンアクセスコントロール (OAC)を作成
    const oacName = `${namePrefix}-front-origin-access-control`
    const cfnOriginAccessControl = new CfnOriginAccessControl(this, oacName, {
      originAccessControlConfig: {
        name: oacName,
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
        description: 'Access Control',
      },
    })

    const cfnDistribution = distribution.node.defaultChild as CfnDistribution
    // 自動で作られるOAIをディストリビューションの紐付けを削除
    cfnDistribution.addPropertyOverride(
      'DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity',
      '',
    )
    // OACをディストリビューションの紐付け
    cfnDistribution.addPropertyOverride(
      'DistributionConfig.Origins.0.OriginAccessControlId',
      cfnOriginAccessControl.attrId,
    )

    return distribution
  }

  private addToResourcePolicy(sourceBucket: Bucket, cloudFrontDistribution: Distribution): void {
    sourceBucket.addToResourcePolicy(
      new PolicyStatement({
        sid: 'AllowCloudFrontServicePrincipal',
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal('cloudfront.amazonaws.com')],
        actions: ['s3:GetObject'],
        resources: [sourceBucket.bucketArn + '/*'],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${cloudFrontDistribution.distributionId}`,
          },
        },
      }),
    )
  }

  private deployTo(sourceBucket: Bucket) {
    new BucketDeployment(this, 'DeployWebsite', {
      sources: [Source.asset('../web')],
      destinationBucket: sourceBucket,
    })
  }
}
