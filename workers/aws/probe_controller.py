"""Read-only IAM/HMAC gate probe using local AWS credentials; no Batch submit."""

from urllib.error import HTTPError
from urllib.request import Request, urlopen

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

from deploy_controller import CONTROL, REGION


def main():
    session = boto3.Session(region_name=REGION)
    url = session.client("lambda").get_function_url_config(FunctionName=CONTROL)["FunctionUrl"]
    body = b'{}'
    aws_request = AWSRequest(method="POST", url=url, data=body, headers={"Content-Type": "application/json"})
    SigV4Auth(session.get_credentials().get_frozen_credentials(), "lambda", REGION).add_auth(aws_request)
    try:
        with urlopen(Request(url, data=body, headers=dict(aws_request.headers), method="POST"), timeout=30) as response:
            print({"http_status": response.status, "header_names": sorted(aws_request.headers)})
    except HTTPError as error:
        print({"http_status": error.code, "header_names": sorted(aws_request.headers),
               "body": error.read(300).decode(errors="replace")})


if __name__ == "__main__":
    main()
