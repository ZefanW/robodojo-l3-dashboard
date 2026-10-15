"""Python standard-library client for the public RoboDojo data API.

Example: python3 examples/api_client.py --task imitate_sorting_sequence
No cloud-drive login, cookies, SDK, API key or third-party dependency is needed.
"""
import argparse
import json
import re
from urllib.request import Request, urlopen

BASE = 'https://zefanw.github.io/robodojo-l3-dashboard/api/v1/'


class Client:
    def __init__(self, base=BASE, timeout=60):
        self.base, self.timeout = base.rstrip('/')+'/', timeout

    def get(self, path):
        request = Request(self.base+path, headers={'Accept':'application/json','Cache-Control':'no-cache'})
        with urlopen(request, timeout=self.timeout) as response:
            return json.load(response)

    @staticmethod
    def identifier(value):
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*',value):
            raise ValueError('Invalid public identifier')
        return value

    def experiments(self):
        return self.get('experiments.json')

    def results(self, experiment_id=None, task=None):
        if experiment_id:
            document = self.get('experiments/'+self.identifier(experiment_id)+'/results.json')
        elif task:
            document = self.get('tasks/'+self.identifier(task)+'.json')
        else:
            document = self.get('results.json')
        if task:
            document = dict(document, results=[r for r in document['results'] if r['episode']['task']==task])
            document['count'] = len(document['results'])
        return document

    def result(self, run_id):
        return self.get('results/'+self.identifier(run_id)+'.json')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--experiment');parser.add_argument('--task');parser.add_argument('--run')
    args = parser.parse_args();client=Client()
    data=client.result(args.run) if args.run else client.results(args.experiment,args.task) if (args.experiment or args.task) else client.experiments()
    print(json.dumps(data,ensure_ascii=False,indent=2))
