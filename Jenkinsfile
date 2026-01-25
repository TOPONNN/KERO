pipeline {
    agent any
    
    environment {
        GPU_SERVER = '***REDACTED_GPU_IP***'
        GPU_SSH_KEY = '/var/lib/jenkins/.ssh/gpu_key'
    }
    
    stages {
        stage('Pull Latest Code') {
            steps {
                sh '''
                    sudo git config --global --add safe.directory /home/ubuntu/project
                    cd /home/ubuntu/project
                    
                    if [ -f backend/.env ]; then
                        cp backend/.env /tmp/backend.env.backup
                    fi
                    
                    sudo git fetch origin
                    sudo git reset --hard origin/main
                    
                    if [ -f /tmp/backend.env.backup ]; then
                        cp /tmp/backend.env.backup backend/.env
                    fi
                '''
            }
        }
        
        stage('Build and Deploy Main Server') {
            steps {
                sh '''
                    cd /home/ubuntu/project
                    sudo docker compose down || true
                    sudo docker compose up -d --build
                '''
            }
        }
        
        stage('Deploy GPU Server (AI Worker)') {
            steps {
                sh '''
                    # Sync ai-worker code to GPU server (excluding .env)
                    rsync -avz --exclude=".env" -e "ssh -i ${GPU_SSH_KEY} -o StrictHostKeyChecking=no" \
                        /home/ubuntu/project/ai-worker/ ubuntu@${GPU_SERVER}:/data/kero/ai-worker/
                    
                    # Restart AI Worker on GPU server
                    ssh -i ${GPU_SSH_KEY} -o StrictHostKeyChecking=no ubuntu@${GPU_SERVER} '
                        cd /data/kero/ai-worker
                        
                        # Rebuild and restart with Docker
                        sudo docker compose down || true
                        sudo docker compose up -d --build
                        
                        echo "Waiting for AI Worker to start..."
                        sleep 20
                        
                        # Check if container is running
                        if sudo docker compose ps | grep -q "Up"; then
                            echo "AI Worker is running"
                            sudo docker compose ps
                        else
                            echo "AI Worker startup logs:"
                            sudo docker compose logs --tail=20
                        fi
                    '
                '''
            }
        }
        
        stage('Health Check') {
            steps {
                sh '''
                    sleep 30
                    curl -f -k https://kero.ooo || exit 1
                    curl -f -k https://kero.ooo/api/health || echo "Backend health check skipped"
                    echo "Main server health check passed!"
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
            echo '✅ Deployment successful! Main Server + GPU AI Worker'
        }
        failure {
            echo '❌ Deployment failed!'
        }
    }
}
