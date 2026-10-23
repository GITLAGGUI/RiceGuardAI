"""Private bounded AWS Batch CPU worker; this does not activate the website.

Build: one capped CodeBuild build. Runtime: Fargate max 2 vCPU / one 2-vCPU
job, 4 GiB, no retries, 30-minute AWS timeout. No idle GPU or web endpoint.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import time
import zipfile

import boto3
from botocore.exceptions import ClientError

REGION = "us-east-1"
ACCOUNT = "342278407276"
NAME = "riceguard-private-inference"
BUCKET = "riceguard-l40s-78407276-20260824"
PREFIX = "website-inference/v2"
ROOT = Path(__file__).resolve().parent
session = boto3.Session(region_name=REGION)


def role(name, principal, statements):
    iam = session.client("iam")
    try:
        result = iam.get_role(RoleName=name)["Role"]
    except iam.exceptions.NoSuchEntityException:
        result = iam.create_role(RoleName=name, AssumeRolePolicyDocument=json.dumps({
            "Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Service": principal},
                                                      "Action": "sts:AssumeRole"}]}),
            Tags=[{"Key": "Project", "Value": "RiceGuard"}])["Role"]
    iam.put_role_policy(RoleName=name, PolicyName="ScopedRiceGuardAccess",
                        PolicyDocument=json.dumps({"Version": "2012-10-17", "Statement": statements}))
    return result["Arn"]


def allow(actions, resource):
    return {"Effect": "Allow", "Action": actions, "Resource": resource}


def log_group(name):
    logs = session.client("logs")
    try:
        logs.create_log_group(logGroupName=name, tags={"Project": "RiceGuard"})
    except logs.exceptions.ResourceAlreadyExistsException:
        pass
    logs.put_retention_policy(logGroupName=name, retentionInDays=7)


def build(reuse_verified_base=False):
    codebuild = session.client("codebuild")
    # Never start another build while one is active for this project.
    try:
        ids = codebuild.list_builds_for_project(projectName=NAME, sortOrder="DESCENDING")["ids"][:5]
    except codebuild.exceptions.ResourceNotFoundException:
        ids = []
    if ids:
        for existing in codebuild.batch_get_builds(ids=ids)["builds"]:
            if existing["buildStatus"] == "IN_PROGRESS":
                print(json.dumps({"build_id": existing["id"], "status": "already_running"}))
                return
    ecr = session.client("ecr")
    try:
        repo = ecr.describe_repositories(repositoryNames=[NAME])["repositories"][0]
    except ecr.exceptions.RepositoryNotFoundException:
        repo = ecr.create_repository(repositoryName=NAME, imageTagMutability="IMMUTABLE",
            encryptionConfiguration={"encryptionType": "AES256"}, tags=[{"Key": "Project", "Value": "RiceGuard"}])["repository"]
    content_hash = hashlib.sha256()
    sources = {}
    for name in ("Dockerfile", "worker.py", "inference_core.py", "website_adapter.py"):
        sources[name] = (ROOT / name).read_bytes()
    if reuse_verified_base:
        # Reuse our already-tested private dependency image, not an alternate
        # account or a repeated request to the rate-limited public registry.
        base = "sha256:84bfef068246eee764de6d694cf8b9f42c57101c461bdcbbf6665c947d185fa1"
        ecr.describe_images(repositoryName=NAME, imageIds=[{"imageDigest": base}])
        sources["Dockerfile"] = (f"FROM {repo['repositoryUri']}@{base}\n"
            "WORKDIR /app\nCOPY inference_core.py website_adapter.py worker.py ./\nUSER 10001\nCMD [\"python\", \"worker.py\"]\n").encode()
    for name in ("Dockerfile", "worker.py", "inference_core.py", "website_adapter.py"):
        content_hash.update(name.encode() + sources[name])
    tag = content_hash.hexdigest()[:24]
    image = f"{repo['repositoryUri']}:{tag}"
    try:
        details = ecr.describe_images(repositoryName=NAME, imageIds=[{"imageTag": tag}])["imageDetails"][0]
        print(json.dumps({"status": "image_already_built", "image": image, "digest": details["imageDigest"]}))
        return
    except ecr.exceptions.ImageNotFoundException:
        pass
    buildspec = {"version": "0.2", "phases": {
        "pre_build": {"commands": [f"aws ecr get-login-password --region {REGION} | docker login --username AWS --password-stdin {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com"]},
        "build": {"commands": [f"docker build -t {image} .", f"docker run --rm --entrypoint python {image} -c \"import torch,ultralytics; print(torch.__version__,ultralytics.__version__)\"", f"docker push {image}"]}}}
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for name, data in sources.items():
            bundle.writestr(name, data)
        bundle.writestr("buildspec.yml", json.dumps(buildspec))
    source_key = f"{PREFIX}/builds/{tag}.zip"
    session.client("s3").put_object(Bucket=BUCKET, Key=source_key, Body=archive.getvalue(), ServerSideEncryption="AES256")
    group = f"/aws/codebuild/{NAME}"
    log_group(group)
    arn = role(NAME + "-build", "codebuild.amazonaws.com", [
        allow("s3:GetObject", f"arn:aws:s3:::{BUCKET}/{PREFIX}/builds/*"),
        allow("ecr:GetAuthorizationToken", "*"),
        allow(["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"], repo["repositoryArn"]),
        allow(["logs:CreateLogStream", "logs:PutLogEvents"], f"arn:aws:logs:{REGION}:{ACCOUNT}:log-group:{group}:*")])
    config = dict(name=NAME, source={"type": "S3", "location": f"{BUCKET}/{source_key}"}, artifacts={"type": "NO_ARTIFACTS"},
        environment={"type": "LINUX_CONTAINER", "image": "aws/codebuild/standard:7.0", "computeType": "BUILD_GENERAL1_SMALL", "privilegedMode": True},
        serviceRole=arn, timeoutInMinutes=15, queuedTimeoutInMinutes=5,
        logsConfig={"cloudWatchLogs": {"status": "ENABLED", "groupName": group}}, concurrentBuildLimit=1)
    if codebuild.batch_get_projects(names=[NAME])["projects"]:
        codebuild.update_project(**config)
    else:
        for attempt in range(6):
            try:
                codebuild.create_project(**config, tags=[{"key": "Project", "value": "RiceGuard"}])
                break
            except ClientError as error:
                if "sts:AssumeRole" not in str(error) or attempt == 5:
                    raise
                time.sleep(5)
    started = codebuild.start_build(projectName=NAME)
    print(json.dumps({"build_id": started["build"]["id"], "image": image, "status": "build_started", "max_build_minutes": 15}))


def runtime():
    ecr = session.client("ecr")
    images = ecr.describe_images(repositoryName=NAME)["imageDetails"]
    if not images:
        raise RuntimeError("No verified container image")
    image = max(images, key=lambda x: x["imagePushedAt"])
    image_uri = f"{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/{NAME}@{image['imageDigest']}"
    ec2 = session.client("ec2")
    vpc = ec2.describe_vpcs(Filters=[{"Name": "is-default", "Values": ["true"]}])["Vpcs"][0]["VpcId"]
    subnets = [s["SubnetId"] for s in ec2.describe_subnets(Filters=[{"Name": "vpc-id", "Values": [vpc]}])["Subnets"] if s["MapPublicIpOnLaunch"]]
    if not subnets:
        raise RuntimeError("No default public-routed subnets; no NAT gateway will be created")
    groups = ec2.describe_security_groups(Filters=[{"Name": "group-name", "Values": [NAME]}, {"Name": "vpc-id", "Values": [vpc]}])["SecurityGroups"]
    if groups:
        sg = groups[0]["GroupId"]
        if groups[0]["IpPermissions"]:
            raise RuntimeError("Unexpected incoming networking permissions")
    else:
        sg = ec2.create_security_group(GroupName=NAME, Description="Private outbound-only inference tasks", VpcId=vpc)["GroupId"]
    group = f"/aws/batch/{NAME}"
    log_group(group)
    execution = role(NAME + "-execution", "ecs-tasks.amazonaws.com", [
        allow("ecr:GetAuthorizationToken", "*"),
        allow(["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"], f"arn:aws:ecr:{REGION}:{ACCOUNT}:repository/{NAME}"),
        allow(["logs:CreateLogStream", "logs:PutLogEvents"], f"arn:aws:logs:{REGION}:{ACCOUNT}:log-group:{group}:*")])
    task = role(NAME + "-task", "ecs-tasks.amazonaws.com", [
        allow("s3:GetObject", [f"arn:aws:s3:::{BUCKET}/{PREFIX}/{part}/*" for part in ("models", "bundles", "jobs")]),
        {**allow("s3:ListBucket", f"arn:aws:s3:::{BUCKET}"), "Condition": {"StringLike": {"s3:prefix": f"{PREFIX}/jobs/*/outputs/*"}}},
        allow("s3:PutObject", f"arn:aws:s3:::{BUCKET}/{PREFIX}/jobs/*/outputs/*")])
    batch = session.client("batch")
    if not batch.describe_compute_environments(computeEnvironments=[NAME])["computeEnvironments"]:
        batch.create_compute_environment(computeEnvironmentName=NAME, type="MANAGED", state="ENABLED",
            computeResources={"type": "FARGATE", "maxvCpus": 2, "subnets": subnets, "securityGroupIds": [sg]},
            tags={"Project": "RiceGuard"})
    env = batch.describe_compute_environments(computeEnvironments=[NAME])["computeEnvironments"][0]
    if env["status"] != "VALID":
        print(json.dumps({"status": "environment_initializing", "state": env["status"]}))
        return
    if not batch.describe_job_queues(jobQueues=[NAME])["jobQueues"]:
        batch.create_job_queue(jobQueueName=NAME, state="ENABLED", priority=1,
            computeEnvironmentOrder=[{"order": 1, "computeEnvironment": env["computeEnvironmentArn"]}], tags={"Project": "RiceGuard"})
    definition = batch.register_job_definition(jobDefinitionName=NAME, type="container", platformCapabilities=["FARGATE"],
        containerProperties={"image": image_uri, "jobRoleArn": task, "executionRoleArn": execution,
            "resourceRequirements": [{"type": "VCPU", "value": "2"}, {"type": "MEMORY", "value": "4096"}],
            "networkConfiguration": {"assignPublicIp": "ENABLED"},
            "fargatePlatformConfiguration": {"platformVersion": "LATEST"},
            "logConfiguration": {"logDriver": "awslogs", "options": {"awslogs-group": group, "awslogs-region": REGION, "awslogs-stream-prefix": "job"}}},
        timeout={"attemptDurationSeconds": 1800}, retryStrategy={"attempts": 1}, tags={"Project": "RiceGuard"})
    print(json.dumps({"status": "private_worker_registered_not_website_activated", "job_definition": definition["jobDefinitionArn"],
        "max_concurrent_vcpu": 2, "job_timeout_seconds": 1800, "image": image_uri}))


def status():
    cb = session.client("codebuild")
    ids = cb.list_builds_for_project(projectName=NAME, sortOrder="DESCENDING")["ids"][:1]
    if ids:
        b = cb.batch_get_builds(ids=ids)["builds"][0]
        print(json.dumps({"build_id": b["id"], "status": b["buildStatus"], "phase": b["currentPhase"],
            "failures": [p.get("contexts") for p in b["phases"] if p.get("phaseStatus") == "FAILED"],
            "logs": b.get("logs", {})}, default=str))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("action", choices=("build", "runtime", "status"))
    p.add_argument("--reuse-verified-base", action="store_true")
    args = p.parse_args()
    action = args.action
    if session.client("sts").get_caller_identity()["Account"] != ACCOUNT:
        raise RuntimeError("Wrong AWS account")
    if action != "status" and session.client("freetier").get_account_plan_state()["accountPlanRemainingCredits"]["amount"] < 20:
        raise RuntimeError("Credit reserve too low; no deployment work started")
    if action == "build":
        build(args.reuse_verified_base)
    else:
        {"runtime": runtime, "status": status}[action]()
