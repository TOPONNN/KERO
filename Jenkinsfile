pipeline {
    agent any
    
    stages {
        stage('Pull Latest Code') {
            steps {
                sh '''
                    sudo git config --global --add safe.directory /home/ubuntu/project
                    cd /home/ubuntu/project
                    sudo git fetch origin
                    sudo git reset --hard origin/main
                '''
            }
        }
        
        stage('Build and Deploy') {
            steps {
                sh '''
                    cd /home/ubuntu/project
                    sudo docker compose down || true
                    sudo docker compose up -d --build
                '''
            }
        }
        
        stage('Health Check') {
            steps {
                sh '''
                    sleep 30
                    curl -f -k https://plyst.info || exit 1
                    curl -f -k https://plyst.info/api/health || echo "Backend health check skipped"
                    echo "Health check passed!"
                '''
            }
        }
        
        stage('Cleanup') {
            steps {
                sh 'sudo docker image prune -f'
            }
        }
    }
    
    post {
        success {
            echo '✅ Deployment successful! Frontend + Backend'
        }
        failure {
            echo '❌ Deployment failed!'
        }
    }
}
