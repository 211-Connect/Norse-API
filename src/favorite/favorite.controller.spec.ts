import { Test, TestingModule } from '@nestjs/testing';
import { FavoriteController } from './favorite.controller';
import { FavoriteService } from './favorite.service';
import { KeycloakAuthService } from 'src/auth/services/keycloak-auth.service';

describe('FavoriteController', () => {
  let controller: FavoriteController;

  const mockFavoriteService = {
    create: jest.fn(),
    remove: jest.fn(),
  };

  const mockKeycloakAuthService = {
    verifyToken: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FavoriteController],
      providers: [
        {
          provide: FavoriteService,
          useValue: mockFavoriteService,
        },
        {
          provide: KeycloakAuthService,
          useValue: mockKeycloakAuthService,
        },
      ],
    }).compile();

    controller = module.get<FavoriteController>(FavoriteController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
